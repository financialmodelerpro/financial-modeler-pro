/**
 * scripts/verify-ai-registry.ts
 *
 * Unit 2 verifier: the AI feature registry.
 *
 * Three layers of checks, in order of how much they can save us:
 *
 *   1. BEHAVIOUR against an in-memory fake of the database. This is where the
 *      teeth are. The property that matters most is that re-registering a
 *      feature never undoes an admin's toggle or cap, and that only runs
 *      against a real read-modify-write sequence, not a regex.
 *   2. PURE contract: validation, coercion of untrusted rows, cap resolution,
 *      and the two payload builders.
 *   3. SOURCE and SQL: the migration is additive and idempotent, the registry
 *      does not breach the Unit 1 containment rule (one SDK import, one key
 *      read), and no em dashes.
 *
 * No database, no network, no API key needed:
 *   npx tsx scripts/verify-ai-registry.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AI_FEATURE_CATEGORIES,
  AI_GROUNDING_TYPES,
  AI_PLATFORM_ALL,
  DEFAULT_AI_MONTHLY_CAPS,
  FALLBACK_AI_MONTHLY_CAP,
  buildAiFeatureInsert,
  buildAiFeatureUpdate,
  coerceAiFeatureRow,
  defaultCapsForPlans,
  featureAppliesToPlatform,
  normalizeFeatureId,
  normalizePlatformSlug,
  resolveAiCap,
  validateAiFeatureInput,
  type AiFeatureInput,
} from '../src/shared/ai/registryTypes';
import {
  getAiFeature,
  listAiFeatures,
  listEnabledAiFeatures,
  registerAiFeature,
  registerAiFeatures,
} from '../src/shared/ai/registry';

const ROOT = join(__dirname, '..');
let pass = 0;
let fail = 0;

function ok(label: string, cond: boolean) {
  if (cond) { pass++; return; }
  fail++;
  console.error(`FAIL ${label}`);
}
function eq(label: string, actual: unknown, expected: unknown) {
  ok(`${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`, actual === expected);
}
function read(rel: string): string { return readFileSync(join(ROOT, rel), 'utf8'); }

// ---------------------------------------------------------------------------
//  In-memory fake of the Supabase query builder
//
//  Only the surface registry.ts actually uses. A table set to undefined is a
//  table that does not exist, which is how the pre-migration state is modelled.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Pred = (r: Row) => boolean;

interface FakeDb { tables: Record<string, Row[] | undefined>; }

let uuidSeq = 0;
const nextUuid = () => `uuid-${++uuidSeq}`;

function exec(db: FakeDb, table: string, s: {
  op: string; filters: Pred[]; payload: unknown; opts: Record<string, unknown> | null;
}): { data: Row[] | null; error: { code?: string; message?: string } | null } {
  const rows = db.tables[table];
  if (rows === undefined) {
    return { data: null, error: { code: '42P01', message: `relation "public.${table}" does not exist` } };
  }
  const match = (r: Row) => s.filters.every((f) => f(r));

  if (s.op === 'select') return { data: rows.filter(match).map((r) => ({ ...r })), error: null };

  if (s.op === 'insert') {
    const row = { id: nextUuid(), ...(s.payload as Row) };
    rows.push(row);
    return { data: [{ ...row }], error: null };
  }

  if (s.op === 'update') {
    for (const r of rows) if (match(r)) Object.assign(r, s.payload as Row);
    return { data: null, error: null };
  }

  if (s.op === 'upsert') {
    const conflict = String(s.opts?.onConflict ?? '').split(',').map((c) => c.trim()).filter(Boolean);
    const ignore = s.opts?.ignoreDuplicates === true;
    for (const incoming of (s.payload as Row[])) {
      const hit = rows.find((r) => conflict.every((c) => r[c] === incoming[c]));
      if (hit) { if (!ignore) Object.assign(hit, incoming); continue; }
      rows.push({ id: nextUuid(), ...incoming });
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
        select() { if (s.op === 'select') s.op = 'select'; return b; },
        insert(p: unknown) { s.op = 'insert'; s.payload = p; return b; },
        update(p: unknown) { s.op = 'update'; s.payload = p; return b; },
        upsert(p: unknown, opts: Record<string, unknown>) { s.op = 'upsert'; s.payload = p; s.opts = opts; return b; },
        eq(c: string, v: unknown) { s.filters.push((r) => r[c] === v); return b; },
        in(c: string, vs: unknown[]) { s.filters.push((r) => vs.includes(r[c])); return b; },
        order() { return b; },
        limit() { return b; },
        range() { return b; },
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
          return Promise.resolve(exec(db, table, s)).then(res, rej);
        },
      };
      return b;
    },
  };
}

function freshDb(opts: { registry?: boolean; plans?: boolean } = {}): FakeDb {
  const registry = opts.registry !== false;
  const plans = opts.plans !== false;
  return {
    tables: {
      ai_features: registry ? [] : undefined,
      ai_feature_caps: registry ? [] : undefined,
      entitlement_plans: plans
        ? [
            { plan_key: 'trial', platform_slug: 'real-estate', active: true },
            { plan_key: 'solo', platform_slug: 'real-estate', active: true },
            { plan_key: 'pro', platform_slug: 'real-estate', active: true },
            { plan_key: 'firm', platform_slug: 'real-estate', active: true },
          ]
        : undefined,
    },
  };
}

const NARRATIVE: AiFeatureInput = {
  featureId: 'm7_ic_narrative',
  platformSlug: 'real-estate',
  name: 'IC narrative',
  description: 'Drafts the IC narrative from the computed model.',
  category: 'narrative',
  grounding: ['model'],
  displayOrder: 1,
};

// ---------------------------------------------------------------------------

async function main() {
  // ── 1. Pure taxonomy ──────────────────────────────────────────────────────
  ok('the four guideline categories are registered',
    AI_FEATURE_CATEGORIES.length === 4
    && ['narrative', 'validation', 'guidance', 'generation'].every((c) => (AI_FEATURE_CATEGORIES as readonly string[]).includes(c)));
  ok('all three grounding types are supported',
    AI_GROUNDING_TYPES.length === 3
    && ['model', 'external', 'context'].every((g) => (AI_GROUNDING_TYPES as readonly string[]).includes(g)));
  eq('the cross-platform sentinel is "all"', AI_PLATFORM_ALL, 'all');

  eq('guideline trial cap', DEFAULT_AI_MONTHLY_CAPS.trial, 5);
  eq('guideline pro cap', DEFAULT_AI_MONTHLY_CAPS.pro, 100);
  eq('guideline firm cap', DEFAULT_AI_MONTHLY_CAPS.firm, 500);
  eq('an unrecognised plan defaults to zero, not unmetered', FALLBACK_AI_MONTHLY_CAP, 0);

  // ── 2. Normalisation and validation ───────────────────────────────────────
  eq('feature id normalises spacing and case', normalizeFeatureId('  M7 IC-Narrative '), 'm7_ic_narrative');
  eq('feature id rejects a leading digit', normalizeFeatureId('7_narrative'), null);
  eq('feature id rejects punctuation', normalizeFeatureId('narrative!'), null);
  eq('platform slug normalises', normalizePlatformSlug(' Real_Estate '), 'real-estate');

  const good = validateAiFeatureInput({ ...NARRATIVE, grounding: ['model', 'context', 'model'] });
  ok('a valid definition validates', good.ok);
  if (good.ok) {
    eq('grounding is deduplicated', good.value.grounding.join(','), 'model,context');
    eq('a feature is created disabled unless it asks otherwise', good.value.enabledOnCreate, false);
  }

  const badCat = validateAiFeatureInput({ ...NARRATIVE, category: 'summary' as never });
  ok('an unknown category is rejected', !badCat.ok);

  const badGround = validateAiFeatureInput({ ...NARRATIVE, grounding: ['market' as never] });
  ok('an unsupported grounding type is rejected', !badGround.ok);

  const noGround = validateAiFeatureInput({ ...NARRATIVE, grounding: [] });
  ok('empty grounding is rejected', !noGround.ok);

  const badOrder = validateAiFeatureInput({ ...NARRATIVE, displayOrder: -1 });
  ok('a negative display order is rejected', !badOrder.ok);

  const badCap = validateAiFeatureInput({ ...NARRATIVE, defaultCaps: { pro: -5 } });
  ok('a negative default cap is rejected', !badCap.ok);

  const manyErrors = validateAiFeatureInput({ featureId: '', platformSlug: '', name: '', category: 'x' as never, grounding: [] });
  ok('validation reports every problem at once, not just the first',
    !manyErrors.ok && manyErrors.errors.length >= 4);

  // ── 3. Payload builders: the anti-clobber contract ────────────────────────
  const validated = validateAiFeatureInput(NARRATIVE);
  if (!validated.ok) throw new Error('the reference definition must validate');
  const insert = buildAiFeatureInsert(validated.value);
  const update = buildAiFeatureUpdate(validated.value);
  ok('the INSERT payload carries enabled', Object.keys(insert).includes('enabled'));
  ok('the UPDATE payload NEVER carries enabled (re-registering must not undo an admin toggle)',
    !Object.keys(update).includes('enabled'));
  ok('the UPDATE payload never rewrites the identity columns',
    !Object.keys(update).includes('feature_id') && !Object.keys(update).includes('platform_slug'));
  ok('the UPDATE payload refreshes the definition',
    ['name', 'description', 'category', 'grounding', 'display_order'].every((k) => Object.keys(update).includes(k)));
  eq('grounding is written as an array', Array.isArray(insert.grounding), true);

  // ── 4. Cap defaults and resolution ────────────────────────────────────────
  const caps = defaultCapsForPlans(['trial', 'solo', 'pro', 'firm']);
  eq('default caps seed trial', caps.trial, 5);
  eq('default caps seed firm', caps.firm, 500);
  const withUnknown = defaultCapsForPlans(['trial', 'agency']);
  eq('a plan with no default gets the zero fallback', withUnknown.agency, 0);
  const withOverride = defaultCapsForPlans(['trial'], { trial: 9, enterprise: 2000 });
  eq('a feature override beats the global default', withOverride.trial, 9);
  eq('an override for a plan outside the live list is kept', withOverride.enterprise, 2000);

  eq('a configured cap resolves to its number', resolveAiCap({ caps: { pro: 100 } }, 'pro'), 100);
  eq('an unconfigured plan resolves to null, NOT zero', resolveAiCap({ caps: { pro: 100 } }, 'firm'), null);
  eq('a configured zero cap stays zero', resolveAiCap({ caps: { trial: 0 } }, 'trial'), 0);

  // ── 5. Coercion of untrusted rows ─────────────────────────────────────────
  const baseRow = {
    id: 'row-1', feature_id: 'm7_ic_narrative', platform_slug: 'real-estate',
    name: 'IC narrative', description: null, category: 'narrative',
    grounding: ['model'], enabled: true, display_order: 1,
  };
  ok('a well formed row coerces', coerceAiFeatureRow(baseRow) !== null);
  eq('an unknown category is dropped rather than repaired',
    coerceAiFeatureRow({ ...baseRow, category: 'summary' }), null);
  eq('a row with no valid grounding is dropped',
    coerceAiFeatureRow({ ...baseRow, grounding: ['market'] }), null);
  eq('a row with no id is dropped', coerceAiFeatureRow({ ...baseRow, id: null }), null);
  ok('a postgres array literal string still coerces',
    coerceAiFeatureRow({ ...baseRow, grounding: '{model,context}' })?.grounding.join(',') === 'model,context');
  eq('enabled is strictly boolean true, not truthy',
    coerceAiFeatureRow({ ...baseRow, enabled: 'yes' })?.enabled, false);
  eq('caps are attached from the caps map',
    coerceAiFeatureRow(baseRow, { pro: 100 })?.caps.pro, 100);
  eq('a negative cap in the database is discarded',
    coerceAiFeatureRow(baseRow, { pro: -1 })?.caps.pro, undefined);

  ok('an "all" feature applies to every platform',
    featureAppliesToPlatform({ platformSlug: AI_PLATFORM_ALL }, 'equity-research'));
  ok('a platform feature does not leak to another platform',
    !featureAppliesToPlatform({ platformSlug: 'real-estate' }, 'equity-research'));

  // ── 6. Migration tolerance (production lags the repo) ─────────────────────
  const noTable = fakeClient(freshDb({ registry: false }));
  const beforeMigration = await listAiFeatures(undefined, noTable);
  eq('a read before migration 203 reports migrationApplied false', beforeMigration.migrationApplied, false);
  eq('a read before migration 203 returns no features instead of throwing', beforeMigration.features.length, 0);
  const regBefore = await registerAiFeature(NARRATIVE, noTable);
  ok('registering before the migration reports unavailable, not a crash',
    !regBefore.ok && regBefore.kind === 'unavailable');
  eq('getAiFeature before the migration returns null',
    await getAiFeature('m7_ic_narrative', 'real-estate', noTable), null);

  // ── 7. Registration: create ───────────────────────────────────────────────
  const db = freshDb();
  const sb = fakeClient(db);

  const created = await registerAiFeature(NARRATIVE, sb);
  ok('registering a new feature succeeds', created.ok);
  if (!created.ok) { console.error('  registration errors:', created.errors); }
  else {
    eq('the first registration reports created', created.created, true);
    eq('a new feature is OFF until an admin enables it', created.feature.enabled, false);
    eq('the feature id round-trips', created.feature.featureId, 'm7_ic_narrative');
    eq('the platform round-trips', created.feature.platformSlug, 'real-estate');
    eq('the category round-trips', created.feature.category, 'narrative');
    eq('the grounding round-trips', created.feature.grounding.join(','), 'model');
    eq('caps are seeded from the live plan list: trial', created.feature.caps.trial, 5);
    eq('caps are seeded from the live plan list: solo', created.feature.caps.solo, 25);
    eq('caps are seeded from the live plan list: pro', created.feature.caps.pro, 100);
    eq('caps are seeded from the live plan list: firm', created.feature.caps.firm, 500);
  }
  eq('exactly one feature row was written', (db.tables.ai_features ?? []).length, 1);
  eq('one cap row per plan was written', (db.tables.ai_feature_caps ?? []).length, 4);

  // ── 8. The load-bearing property: re-registration preserves admin intent ──
  // Simulate the admin panel (Unit 5): turn the feature on and cut the pro cap.
  const featureRow = (db.tables.ai_features ?? [])[0];
  featureRow.enabled = true;
  const proCapRow = (db.tables.ai_feature_caps ?? []).find((r) => r.plan_key === 'pro');
  if (proCapRow) proCapRow.monthly_cap = 42;

  const again = await registerAiFeature(
    { ...NARRATIVE, name: 'IC narrative (renamed)', grounding: ['model', 'context'], displayOrder: 3 },
    sb,
  );
  ok('re-registering succeeds', again.ok);
  if (again.ok) {
    eq('re-registration reports created:false', again.created, false);
    eq('the definition IS refreshed (name)', again.feature.name, 'IC narrative (renamed)');
    eq('the definition IS refreshed (grounding)', again.feature.grounding.join(','), 'model,context');
    eq('the definition IS refreshed (display order)', again.feature.displayOrder, 3);
    eq('an admin ENABLE survives re-registration', again.feature.enabled, true);
    eq('an admin-edited CAP survives re-registration', again.feature.caps.pro, 42);
    eq('untouched caps are unchanged', again.feature.caps.firm, 500);
  }
  eq('re-registration does not duplicate the feature row', (db.tables.ai_features ?? []).length, 1);
  eq('re-registration does not duplicate cap rows', (db.tables.ai_feature_caps ?? []).length, 4);

  // A plan created after the feature picks up a default on the next registration.
  (db.tables.entitlement_plans ?? []).push({ plan_key: 'agency', platform_slug: 'real-estate', active: true });
  const third = await registerAiFeature(NARRATIVE, sb);
  ok('a plan added later gets a cap row on the next registration',
    third.ok && third.feature.caps.agency === FALLBACK_AI_MONTHLY_CAP);
  ok('and the admin-edited cap is still untouched', third.ok && third.feature.caps.pro === 42);

  // ── 9. Validation blocks the write ────────────────────────────────────────
  const rejected = await registerAiFeature({ ...NARRATIVE, featureId: '9bad', category: 'x' as never }, sb);
  ok('an invalid definition is rejected as invalid', !rejected.ok && rejected.kind === 'invalid');
  eq('an invalid definition writes NOTHING', (db.tables.ai_features ?? []).length, 1);

  // ── 10. Platform scoping ──────────────────────────────────────────────────
  const erm = await registerAiFeature({ ...NARRATIVE, platformSlug: 'equity-research', name: 'ERM IC narrative' }, sb);
  ok('the same feature id registers under a second platform', erm.ok);
  eq('a second platform means a second row', (db.tables.ai_features ?? []).length, 2);

  const shared = await registerAiFeature({
    featureId: 'onboarding_guide', platformSlug: AI_PLATFORM_ALL, name: 'Onboarding guide',
    category: 'guidance', grounding: ['context'], displayOrder: 9,
  }, sb);
  ok('a cross-platform feature registers under "all"', shared.ok);

  const refmList = await listAiFeatures('real-estate', sb);
  const refmIds = refmList.features.map((f) => `${f.platformSlug}:${f.featureId}`).sort();
  ok(`a platform read returns its own features plus the shared ones (got ${refmIds.join(' ')})`,
    refmIds.length === 2
    && refmIds.includes('real-estate:m7_ic_narrative')
    && refmIds.includes('all:onboarding_guide'));
  ok('another platform does not see the first platform feature',
    (await listAiFeatures('equity-research', sb)).features.every((f) => f.platformSlug !== 'real-estate'));

  const all = await listAiFeatures(undefined, sb);
  eq('an unfiltered read returns the whole registry', all.features.length, 3);
  eq('a healthy registry reports no skipped rows', all.skipped, 0);
  ok('features come back in display order',
    all.features.map((f) => f.displayOrder).every((d, i, xs) => i === 0 || xs[i - 1] <= d));

  const exact = await getAiFeature('m7_ic_narrative', 'real-estate', sb);
  eq('getAiFeature resolves the exact platform first', exact?.platformSlug, 'real-estate');
  const viaAll = await getAiFeature('onboarding_guide', 'real-estate', sb);
  eq('getAiFeature falls back to the cross-platform registration', viaAll?.platformSlug, AI_PLATFORM_ALL);
  eq('getAiFeature returns null for an unregistered feature',
    await getAiFeature('does_not_exist', 'real-estate', sb), null);

  // ── 11. Enabled-only read ─────────────────────────────────────────────────
  const enabledOnly = await listEnabledAiFeatures('real-estate', sb);
  ok('the enabled-only read excludes disabled features',
    enabledOnly.features.length === 1 && enabledOnly.features[0].featureId === 'm7_ic_narrative');

  // ── 12. A hand-damaged row is skipped, not fatal ──────────────────────────
  (db.tables.ai_features ?? []).push({
    id: 'row-bad', feature_id: 'broken', platform_slug: 'real-estate',
    name: 'Broken', category: 'not-a-category', grounding: ['model'], enabled: true, display_order: 0,
  });
  const withBad = await listAiFeatures(undefined, sb);
  eq('a row with an unknown category is skipped', withBad.skipped, 1);
  eq('the healthy rows still come back', withBad.features.length, 3);

  // ── 13. Batch registration ────────────────────────────────────────────────
  const batch = await registerAiFeatures([
    { featureId: 'adr_validation', platformSlug: 'real-estate', name: 'ADR validation', category: 'validation', grounding: ['external'] },
    { featureId: '9_bad_id', platformSlug: 'real-estate', name: 'Bad', category: 'validation', grounding: ['external'] },
  ], sb);
  eq('a batch returns one result per input', batch.length, 2);
  ok('one bad definition does not hide the good one', batch[0].ok && !batch[1].ok);

  // ── 14. Migration SQL ─────────────────────────────────────────────────────
  const sql = read('supabase/migrations/203_ai_feature_registry.sql');
  ok('the migration creates ai_features idempotently', /CREATE TABLE IF NOT EXISTS ai_features/.test(sql));
  ok('the migration creates ai_feature_caps idempotently', /CREATE TABLE IF NOT EXISTS ai_feature_caps/.test(sql));
  ok('the migration is ADDITIVE: no DROP TABLE',
    !/DROP\s+TABLE/i.test(sql));
  ok('the migration is ADDITIVE: no column drop or type change on an existing table',
    !/ALTER\s+TABLE\s+\w+\s+DROP/i.test(sql) && !/ALTER\s+COLUMN/i.test(sql));
  ok('the migration destroys no data', !/TRUNCATE|DELETE\s+FROM/i.test(sql));
  ok('feature identity is unique per platform', /UNIQUE\s*\(\s*platform_slug\s*,\s*feature_id\s*\)/.test(sql));
  ok('a cap is unique per feature and plan', /UNIQUE\s*\(\s*ai_feature_id\s*,\s*plan_key\s*\)/.test(sql));
  ok('the caps FK cascades from the feature',
    /ai_feature_id\s+uuid\s+NOT NULL REFERENCES ai_features\(id\) ON DELETE CASCADE/.test(sql));
  ok('category is constrained to the four guideline categories',
    AI_FEATURE_CATEGORIES.every((c) => new RegExp(`CHECK[\\s\\S]{0,200}'${c}'`).test(sql)));
  ok('grounding is an array column', /grounding\s+text\[\]\s+NOT NULL/.test(sql));
  ok('grounding is constrained to a subset of the three supported types',
    /grounding <@ ARRAY\['model', 'external', 'context'\]/.test(sql));

  // The emptiness guard is checked against the CORRECTED constraint in
  // migration 204, not 203. 203 wrote array_length(grounding, 1) >= 1, which
  // NEVER FIRES: array_length on an empty array returns NULL, NULL >= 1 is
  // NULL, and a CHECK passes on NULL because only an explicit FALSE rejects.
  // A live insert of '{}' was accepted, which is how this was caught. This
  // assertion deliberately fails the NULL-trap form so the dead guard can never
  // come back, in this table or a future one.
  const fixSql = read('supabase/migrations/204_ai_features_grounding_check_fix.sql');
  ok('migration 204 replaces the dead emptiness guard with cardinality()',
    /cardinality\(grounding\) >= 1/.test(fixSql));
  ok('204 drops the old constraint by DEFINITION, so the auto-generated name cannot matter',
    /pg_get_constraintdef\(oid\) ILIKE '%array_length\(grounding%'/.test(fixSql));
  ok('204 is re-runnable (guarded add, table-absent guard)',
    /to_regclass\('public\.ai_features'\) IS NULL/.test(fixSql)
    && /conname = 'ai_features_grounding_valid'/.test(fixSql));
  // Assertions about what the SQL DOES run against comment-stripped code: 204
  // quotes the broken constraint in its own header to explain the bug, and a
  // naive scan would read that prose as the constraint itself.
  const fixCode = fixSql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  ok('204 changes no data and no columns',
    !/INSERT|UPDATE|DELETE|TRUNCATE|DROP\s+TABLE|ADD\s+COLUMN|DROP\s+COLUMN/i.test(fixCode));
  ok('the NULL-trap array_length form is not the guard 204 installs',
    !/CHECK\s*\([\s\S]{0,120}array_length\(grounding/.test(fixCode));
  ok('a new feature is disabled by default in the schema too',
    /enabled\s+boolean NOT NULL DEFAULT false/.test(sql));
  ok('a cap cannot be negative', /monthly_cap\s+integer NOT NULL DEFAULT 0 CHECK \(monthly_cap >= 0\)/.test(sql));
  ok('RLS is enabled on both tables',
    /ALTER TABLE ai_features\s+ENABLE ROW LEVEL SECURITY/.test(sql)
    && /ALTER TABLE ai_feature_caps ENABLE ROW LEVEL SECURITY/.test(sql));
  ok('the updated_at trigger creation is guarded on the helper existing',
    /pg_proc WHERE proname = 'update_updated_at'/.test(sql));
  ok('the migration seeds NO feature rows (registration owns that)',
    !/INSERT\s+INTO\s+ai_features/i.test(sql));
  ok('plan_key is not foreign-keyed, so a new plan stays data',
    !/plan_key\s+text NOT NULL REFERENCES/i.test(sql));

  // ── 15. Containment and house style ───────────────────────────────────────
  const typesSrc = read('src/shared/ai/registryTypes.ts');
  const registrySrc = read('src/shared/ai/registry.ts');

  ok('the registry does not import the Anthropic SDK (Unit 1 containment holds)',
    !/@anthropic-ai\/sdk/.test(registrySrc) && !/@anthropic-ai\/sdk/.test(typesSrc));
  ok('the registry does not read the API key',
    !/ANTHROPIC_API_KEY/.test(registrySrc) && !/ANTHROPIC_API_KEY/.test(typesSrc));
  ok('the pure layer stays pure (no supabase import)',
    !/@supabase\/supabase-js/.test(typesSrc) && !/core\/db\/supabase/.test(typesSrc));
  ok('the registry reuses the canonical plan keys rather than redefining them',
    /entitlements\/gate/.test(typesSrc));
  ok('there is no admin write path in Unit 2 (toggles and caps are Unit 5)',
    !/export (async )?function set(AiFeature)?(Enabled|Caps)/.test(registrySrc));
  ok('the registry hardcodes no platform',
    !/real-estate|refm/i.test(registrySrc.replace(/\/\*[\s\S]*?\*\//g, '')) );

  // Built from the code point, never written literally, so this file can check
  // ITSELF without failing on its own assertion.
  const EM_DASH = String.fromCharCode(0x2014);
  for (const [label, src] of [
    ['registryTypes.ts', typesSrc],
    ['registry.ts', registrySrc],
    ['203_ai_feature_registry.sql', sql],
    ['204_ai_features_grounding_check_fix.sql', fixSql],
    ['verify-ai-registry.ts', read('scripts/verify-ai-registry.ts')],
  ] as const) {
    ok(`${label} contains no em dashes`, !src.includes(EM_DASH));
  }

  console.log(`\nverify-ai-registry: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error('verify-ai-registry crashed:', err);
  process.exit(1);
});
