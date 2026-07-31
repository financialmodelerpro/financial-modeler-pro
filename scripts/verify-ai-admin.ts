/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * scripts/verify-ai-admin.ts
 *
 * Unit 5 verifier: the AI admin control panel.
 *
 * The teeth are in two places.
 *
 * 1. CAP EDITS ARE SURGICAL. Editing one tier must not disturb another, and
 *    setting a cap for a plan that has no row yet must CREATE it rather than
 *    silently do nothing. Both are exercised against an in-memory database
 *    fake, not asserted by reading the code.
 *
 * 2. USAGE IS HONEST. The panel is specified to show usage, and the metering
 *    unit that produces usage does not exist yet. The failure mode to prevent
 *    is a zero: "0 calls" and "nothing is measured" look identical to an admin.
 *    So the verifier asserts the report is unavailable WITH a reason, that the
 *    reason does not claim a count, and that the page renders that reason
 *    rather than a number.
 *
 * Pure + fake DB. No database, no network, no API key:
 *   npx tsx scripts/verify-ai-admin.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isValidCap, setAiFeatureCaps, setAiFeatureEnabled, validateCapEdits } from '../src/shared/ai/registryAdmin';
import { registerAiFeature, getAiFeature, listAiFeatures } from '../src/shared/ai/registry';
import { USAGE_UNAVAILABLE_REASON, loadAiUsage, usageFor } from '../src/shared/ai/usage';
import { AI_PLATFORM_ALL } from '../src/shared/ai/registryTypes';

const ROOT = join(__dirname, '..');
let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; return; }
  fail++;
  console.error(`FAIL ${label}${detail ? ` :: ${detail}` : ''}`);
};
const eq = (label: string, actual: unknown, expected: unknown) =>
  ok(`${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`, actual === expected);
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

// ── In-memory Supabase fake (same shape the Unit 2 verifier uses) ───────────
type Row = Record<string, unknown>;
type Pred = (r: Row) => boolean;
interface FakeDb { tables: Record<string, Row[] | undefined> }

let seq = 0;
const nextId = () => `uuid-${++seq}`;

function exec(db: FakeDb, table: string, s: { op: string; filters: Pred[]; payload: unknown; opts: Record<string, unknown> | null }) {
  const rows = db.tables[table];
  if (rows === undefined) return { data: null, error: { code: '42P01', message: `relation "public.${table}" does not exist` } };
  const match = (r: Row) => s.filters.every((f) => f(r));

  if (s.op === 'select') return { data: rows.filter(match).map((r) => ({ ...r })), error: null };
  if (s.op === 'insert') { const row = { id: nextId(), ...(s.payload as Row) }; rows.push(row); return { data: [{ ...row }], error: null }; }
  if (s.op === 'update') {
    const hit = rows.filter(match);
    for (const r of hit) Object.assign(r, s.payload as Row);
    return { data: hit.map((r) => ({ ...r })), error: null };
  }
  if (s.op === 'upsert') {
    const conflict = String(s.opts?.onConflict ?? '').split(',').map((c) => c.trim()).filter(Boolean);
    const ignore = s.opts?.ignoreDuplicates === true;
    for (const incoming of s.payload as Row[]) {
      const hit = rows.find((r) => conflict.every((c) => r[c] === incoming[c]));
      if (hit) { if (!ignore) Object.assign(hit, incoming); continue; }
      rows.push({ id: nextId(), ...incoming });
    }
    return { data: null, error: null };
  }
  return { data: null, error: { message: `unsupported op ${s.op}` } };
}

function fakeClient(db: FakeDb): any {
  return {
    from(table: string) {
      const s = { op: 'select', filters: [] as Pred[], payload: null as unknown, opts: null as Record<string, unknown> | null };
      const b: any = {
        select() { return b; },
        insert(p: unknown) { s.op = 'insert'; s.payload = p; return b; },
        update(p: unknown) { s.op = 'update'; s.payload = p; return b; },
        upsert(p: unknown, o: Record<string, unknown>) { s.op = 'upsert'; s.payload = p; s.opts = o; return b; },
        eq(c: string, v: unknown) { s.filters.push((r) => r[c] === v); return b; },
        in(c: string, vs: unknown[]) { s.filters.push((r) => vs.includes(r[c])); return b; },
        order() { return b; }, limit() { return b; }, range() { return b; },
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
          return Promise.resolve(exec(db, table, s)).then(res, rej);
        },
      };
      return b;
    },
  };
}

const freshDb = (registry = true): FakeDb => ({
  tables: {
    ai_features: registry ? [] : undefined,
    ai_feature_caps: registry ? [] : undefined,
    entitlement_plans: [
      { plan_key: 'trial', platform_slug: 'real-estate', active: true },
      { plan_key: 'pro', platform_slug: 'real-estate', active: true },
      { plan_key: 'firm', platform_slug: 'real-estate', active: true },
    ],
  },
});

const NARRATIVE = {
  featureId: 'm7_ic_narrative', platformSlug: 'real-estate', name: 'IC narrative',
  category: 'narrative' as const, grounding: ['model' as const], displayOrder: 1,
};

async function main() {
  // ── 1. Pure cap validation ────────────────────────────────────────────────
  ok('a zero cap is valid (deny a tier without disabling the feature)', isValidCap(0));
  ok('a positive integer cap is valid', isValidCap(100));
  ok('a negative cap is rejected', !isValidCap(-1));
  ok('a fractional cap is rejected', !isValidCap(2.5));
  ok('a non-number cap is rejected', !isValidCap('100' as unknown));
  ok('an absurd cap is rejected', !isValidCap(9_999_999));
  ok('there is no unlimited sentinel: -1 is not special-cased', !isValidCap(-1));

  const good = validateCapEdits({ trial: 5, pro: 100 });
  ok('a valid edit set validates', good.ok);
  const bad = validateCapEdits({ trial: -5, pro: 1.5 });
  ok('every bad cap is reported, not just the first', !bad.ok && bad.errors.length === 2);
  ok('an empty edit set is rejected', !validateCapEdits({}).ok);

  // ── 2. Registry unavailable (pre-migration) ───────────────────────────────
  const noTables = fakeClient(freshDb(false));
  const offEarly = await setAiFeatureEnabled('x', 'real-estate', true, noTables);
  ok('toggling before the migration reports unavailable, not a crash', !offEarly.ok && offEarly.kind === 'unavailable');
  const capsEarly = await setAiFeatureCaps('x', 'real-estate', { pro: 10 }, noTables);
  ok('setting caps before the migration reports unavailable', !capsEarly.ok && capsEarly.kind === 'unavailable');

  // ── 3. Toggle ─────────────────────────────────────────────────────────────
  const db = freshDb();
  const sb = fakeClient(db);
  const created = await registerAiFeature(NARRATIVE, sb);
  ok('a feature registers for the panel to manage', created.ok);
  eq('and starts OFF', created.ok && created.feature.enabled, false);

  const on = await setAiFeatureEnabled('m7_ic_narrative', 'real-estate', true, sb);
  ok('the admin can turn it on', on.ok);
  eq('the returned feature reflects the STORED row', on.ok && on.feature.enabled, true);
  eq('and the row itself changed', (db.tables.ai_features ?? [])[0].enabled, true);

  const off = await setAiFeatureEnabled('m7_ic_narrative', 'real-estate', false, sb);
  eq('the admin can turn it off again', off.ok && off.feature.enabled, false);

  const missing = await setAiFeatureEnabled('does_not_exist', 'real-estate', true, sb);
  ok('toggling an unregistered feature reports not_found', !missing.ok && missing.kind === 'not_found');

  const wrongPlatform = await setAiFeatureEnabled('m7_ic_narrative', 'equity-research', true, sb);
  ok('a feature cannot be toggled from another platform', !wrongPlatform.ok && wrongPlatform.kind === 'not_found');

  // ── 4. Caps: the surgical property ────────────────────────────────────────
  const before = await getAiFeature('m7_ic_narrative', 'real-estate', sb);
  eq('seeded trial cap', before?.caps.trial, 5);
  eq('seeded pro cap', before?.caps.pro, 100);
  eq('seeded firm cap', before?.caps.firm, 500);

  const edited = await setAiFeatureCaps('m7_ic_narrative', 'real-estate', { pro: 42 }, sb);
  ok('editing one cap succeeds', edited.ok);
  eq('the edited cap changed', edited.ok && edited.feature.caps.pro, 42);
  eq('an untouched cap is NOT disturbed (trial)', edited.ok && edited.feature.caps.trial, 5);
  eq('an untouched cap is NOT disturbed (firm)', edited.ok && edited.feature.caps.firm, 500);
  eq('no duplicate cap rows were created', (db.tables.ai_feature_caps ?? []).filter((r) => r.plan_key === 'pro').length, 1);

  // A plan with no cap row yet must be CREATED, not silently skipped. An
  // update-only implementation passes every other test and fails this one.
  const newPlan = await setAiFeatureCaps('m7_ic_narrative', 'real-estate', { agency: 7 }, sb);
  ok('a cap for a plan with no row yet is CREATED', newPlan.ok && newPlan.feature.caps.agency === 7,
    newPlan.ok ? JSON.stringify(newPlan.feature.caps) : 'write failed');

  const zero = await setAiFeatureCaps('m7_ic_narrative', 'real-estate', { trial: 0 }, sb);
  eq('a cap can be set to zero (deny a tier)', zero.ok && zero.feature.caps.trial, 0);

  const capsBefore = JSON.stringify((db.tables.ai_feature_caps ?? []).map((r) => [r.plan_key, r.monthly_cap]).sort());
  const rejected = await setAiFeatureCaps('m7_ic_narrative', 'real-estate', { pro: -1 }, sb);
  ok('an invalid cap is rejected as invalid', !rejected.ok && rejected.kind === 'invalid');
  eq('and NOTHING was written', JSON.stringify((db.tables.ai_feature_caps ?? []).map((r) => [r.plan_key, r.monthly_cap]).sort()), capsBefore);

  const capsMissing = await setAiFeatureCaps('nope', 'real-estate', { pro: 1 }, sb);
  ok('caps on an unregistered feature report not_found', !capsMissing.ok && capsMissing.kind === 'not_found');

  // ── 5. Admin intent survives a later deploy ───────────────────────────────
  // The panel is worthless if the next registration silently reverts it.
  await setAiFeatureEnabled('m7_ic_narrative', 'real-estate', true, sb);
  await setAiFeatureCaps('m7_ic_narrative', 'real-estate', { pro: 42 }, sb);
  const reRegistered = await registerAiFeature({ ...NARRATIVE, name: 'IC narrative v2' }, sb);
  ok('re-registration succeeds', reRegistered.ok);
  eq('an admin ENABLE survives re-registration', reRegistered.ok && reRegistered.feature.enabled, true);
  eq('an admin CAP survives re-registration', reRegistered.ok && reRegistered.feature.caps.pro, 42);
  eq('the definition still refreshes', reRegistered.ok && reRegistered.feature.name, 'IC narrative v2');

  // ── 6. Panel auto-discovery ───────────────────────────────────────────────
  await registerAiFeature({
    featureId: 'onboarding_guide', platformSlug: AI_PLATFORM_ALL, name: 'Onboarding guide',
    category: 'guidance', grounding: ['context'], displayOrder: 9,
  }, sb);
  const listed = await listAiFeatures(undefined, sb);
  eq('a newly registered feature appears with no code change', listed.features.length, 2);

  // ── 7. USAGE HONESTY ──────────────────────────────────────────────────────
  // Metering now exists (the counters land with migration 205), so the panel
  // CAN show real numbers. What must never regress is the unavailable path:
  // when usage cannot be read, the panel says so instead of rendering zeroes.
  // Called with no client on purpose, which is the "no store reachable" case.
  const usage = await loadAiUsage('real-estate');
  eq('an unreadable usage store reports unavailable, and does NOT throw', usage.available, false);
  ok('and gives a reason', !usage.available && usage.reason.length > 30);
  ok('the reason explicitly denies that this means zero',
    !usage.available && /not a count of zero/i.test(usage.reason));
  eq('usageFor returns null when usage is unavailable', usageFor(usage, 'm7_ic_narrative', 'real-estate'), null);
  eq('the reason comes from the single exported constant, so the panel and the seam cannot drift',
    !usage.available && usage.reason, USAGE_UNAVAILABLE_REASON);

  // ── 8. Source assertions: the panel, the route, the boundary ──────────────
  const page = read('app/admin/ai-features/page.tsx');
  const route = read('app/api/admin/ai-features/route.ts');
  const admin = read('src/shared/ai/registryAdmin.ts');
  const usageSrc = read('src/shared/ai/usage.ts');
  const nav = read('src/components/admin/CmsAdminNav.tsx');

  ok('the panel renders the unavailable REASON, not a zero', page.includes('usage.reason'));
  ok('the panel marks the unavailable state for testing', page.includes('usage-unavailable'));
  ok('the usage cell says "not tracked" rather than 0 when unmeasured', page.includes("'not tracked'"));
  ok('the panel hardcodes NO feature list (features come from the registry)',
    !/m7_ic_narrative|ic_narrative/.test(page));
  ok('the panel maps over registry groups', /groups\.map/.test(page));

  ok('the API route guards on an admin session', /getServerSession/.test(route) && /role.*admin/.test(route));
  ok('the API route returns 401 to non-admins', /'Unauthorized' \}, \{ status: 401 \}/.test(route));
  ok('the API route is force-dynamic (a cached admin list reads as a failed save)',
    /export const dynamic = 'force-dynamic'/.test(route));
  ok('platform labels are derived from the platform catalog, not hardcoded',
    /PLATFORMS/.test(route) && !/Real Estate Financial Modeling/.test(route));
  ok('plan columns are derived from the canonical plan keys', /KNOWN_PLAN_KEYS/.test(route));

  // The boundary that keeps the panel from overwriting code-owned contract.
  for (const field of ['category', 'grounding', 'feature_id', 'platform_slug']) {
    ok(`the admin write path never updates ${field}`,
      !new RegExp(`update\\([^)]*${field}`).test(admin));
  }
  ok('the admin module exposes only the two intended writes',
    /export async function setAiFeatureEnabled/.test(admin)
    && /export async function setAiFeatureCaps/.test(admin)
    && !/export async function (deleteAiFeature|createAiFeature|setAiFeatureCategory)/.test(admin));
  ok('the runtime read path still has no setters (Unit 2 boundary intact)',
    !/export async function set/.test(read('src/shared/ai/registry.ts')));

  ok('the nav exposes the panel', /\/admin\/ai-features/.test(nav));

  ok('the admin write path does not read the API key or import the SDK',
    !/ANTHROPIC_API_KEY/.test(admin) && !/@anthropic-ai\/sdk/.test(admin));
  ok('usage.ts keeps the unavailable path load-bearing now that metering exists',
    /UNAVAILABLE PATH IS STILL LOAD-BEARING/.test(usageSrc));

  const EM_DASH = String.fromCharCode(0x2014);
  for (const [name, src] of [
    ['registryAdmin.ts', admin], ['usage.ts', usageSrc], ['ai-features/route.ts', route],
    ['ai-features/page.tsx', page], ['verify-ai-admin.ts', read('scripts/verify-ai-admin.ts')],
  ] as const) {
    ok(`${name} contains no em dashes`, !src.includes(EM_DASH));
  }

  console.log(`\nverify-ai-admin: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => { console.error('verify-ai-admin crashed:', err); process.exit(1); });
