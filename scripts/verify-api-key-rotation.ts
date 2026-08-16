/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * verify-api-key-rotation.ts
 *
 * Locks rotation of the partner feed key: Admin > API Keys, the shared
 * resolver, and migration 213.
 *
 * The four things it is really protecting:
 *
 *   1. THE OLD KEY DIES. After a rotation the previous value is refused, on the
 *      next request, with no cache and no overlap. That includes the FIRST
 *      rotation, where the thing being retired is the environment variable.
 *   2. NO RESURRECTION. Retiring every key closes the endpoint. It must never
 *      fall back to the environment value that a rotation superseded, and an
 *      unreadable key store must refuse rather than be read as "no rows".
 *   3. THE VALUE DOES NOT SURVIVE. Only a SHA-256 and a short prefix are
 *      stored, the admin read route refuses to reveal a rotated key, and no
 *      audit row carries a value.
 *   4. ROTATION IS GUARDED AND RECORDED. No admin session, no rotation, and no
 *      row written; every rotation writes api_key_rotated.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────────────────
 *
 * It never rotates the REAL key id. Running a verifier must not hand the
 * partner a 401, and a rotated key cannot be un-rotated. Every behavioural
 * check runs against a PROBE key id in the live database, using the same
 * resolver the public route calls, and the probe rows are deleted afterwards.
 * The route's wiring to that resolver is asserted at source level, which is the
 * one seam this script cannot exercise end to end.
 *
 * Run: npx tsx scripts/verify-api-key-rotation.ts
 *
 * No em dashes in this file.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

for (const f of ['.env.local', '.env']) {
  try {
    for (const l of readFileSync(f, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* optional */ }
}

import {
  generateApiKey, hashApiKey, keyPrefix, generateKeyRecord, constantTimeEqual,
  resolveKeyState, verifyApiKey, rotateApiKey,
  PUBLIC_PAGES_KEY_ID, KEY_TAG, KEY_PREFIX_CHARS,
} from '../src/shared/api/publicApiKeys';

let pass = 0, fail = 0, skip = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, detail = ''): void => {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`  [FAIL] ${name}${detail ? ' :: ' + detail : ''}`); }
};
const skipped = (name: string, why: string): void => {
  skip++; console.log(`  [SKIP] ${name} :: ${why}`);
};

const read = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');

/**
 * Source with comments removed.
 *
 * Needed because these files EXPLAIN the dangerous pattern they avoid: the
 * registry's own header says the client never names an environment variable by
 * quoting `process.env[whatever the browser sent]`. A naive grep read that
 * prose as the defect it was warning about. A check that fires on a comment is
 * a check that will be silenced by deleting the comment.
 */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** The em dash, built rather than typed, so this file can check for it. */
const EM_DASH = String.fromCharCode(0x2014);

/** A key id that is not, and must never be, the live one. */
const PROBE_ID = 'verify-rotation-probe';
const PROBE_ENV = 'probe-environment-key-0123456789';

async function main(): Promise<void> {
  console.log('=== API key rotation ===\n');

  // ── 1. Key generation ─────────────────────────────────────────────────────
  console.log('-- 1. Generated keys --');
  const k1 = generateApiKey();
  check('a generated key carries the identifying tag', k1.startsWith(KEY_TAG), k1.slice(0, 10));
  check('a generated key is long enough to be unguessable', k1.length >= 40, `length ${k1.length}`);
  const body = k1.slice(KEY_TAG.length);
  check('the random part is base64url only (survives a header and a copy paste)',
    /^[A-Za-z0-9_-]+$/.test(body), body);
  const many = new Set(Array.from({ length: 500 }, () => generateApiKey()));
  check('500 generated keys are all distinct', many.size === 500, `distinct ${many.size}`);

  const rec = generateKeyRecord();
  check('the hash is 64 hex characters (SHA-256)', /^[0-9a-f]{64}$/.test(rec.hash), rec.hash);
  check('the hash is stable for the same value', hashApiKey(rec.value) === rec.hash);
  const nudged = rec.value.slice(0, -1) + (rec.value.endsWith('a') ? 'b' : 'a');
  check('one changed character changes the hash', hashApiKey(nudged) !== rec.hash);
  check('the hash does not contain the key', !rec.hash.includes(rec.value));
  check('the prefix is the head of the key', rec.value.startsWith(rec.prefix));
  check(`the prefix is ${KEY_PREFIX_CHARS} characters`, rec.prefix.length === KEY_PREFIX_CHARS, `${rec.prefix.length}`);
  check('the prefix discloses only a small fraction of the key',
    rec.prefix.length < rec.value.length / 2, `${rec.prefix.length} of ${rec.value.length}`);
  check('keyPrefix() and generateKeyRecord() agree', keyPrefix(rec.value) === rec.prefix);

  // ── 2. Constant-time compare ──────────────────────────────────────────────
  console.log('\n-- 2. Comparison --');
  check('equal strings match', constantTimeEqual('abc123', 'abc123'));
  check('a same-length near miss does not match', constantTimeEqual('abc123', 'abc124') === false);
  check('different lengths do not match, and do not throw', constantTimeEqual('abc', 'abcd') === false);
  check('an empty presented key does not match a real one', constantTimeEqual('', 'abc') === false);
  check('two empty strings are not treated as a valid key by the caller',
    // The compare itself is honest about equality; refusing an empty key is the
    // resolver's job, asserted in section 4.
    constantTimeEqual('', '') === true);

  // ── 3. Database and migration ─────────────────────────────────────────────
  console.log('\n-- 3. Migration 213 --');
  const mig = read('supabase/migrations/213_public_api_keys.sql');
  check('the table stores a hash, not a key', /key_hash/.test(mig) && !/key_value|key_plain|secret\s+text/.test(mig));
  check('at most one active key per id is enforced by a partial unique index',
    /CREATE UNIQUE INDEX[^;]*public_api_keys[\s\S]*?WHERE status = 'active'/.test(mig));
  check('rotation is a single transactional function', /CREATE OR REPLACE FUNCTION rotate_public_api_key/.test(mig));
  check('the rotation function is not SECURITY DEFINER', !/SECURITY DEFINER/.test(mig));
  check('execute is revoked from anon and authenticated',
    /REVOKE ALL ON FUNCTION rotate_public_api_key[^;]*FROM anon/.test(mig)
    && /REVOKE ALL ON FUNCTION rotate_public_api_key[^;]*FROM authenticated/.test(mig));
  check('row level security is enabled on the table', /ALTER TABLE public_api_keys ENABLE ROW LEVEL SECURITY/.test(mig));

  const { createClient } = await import('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !svc) {
    console.log('\n  Database credentials are absent. Behavioural sections need a live database.');
    skipped('sections 4 to 6 (behaviour against the live database)', 'no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    report();
    return;
  }
  const sb = createClient(url, svc, { auth: { persistSession: false } });

  const probe = await sb.from('public_api_keys').select('id').eq('key_id', PROBE_ID).limit(1);
  if (probe.error && /does not exist|schema cache|could not find the table/i.test(probe.error.message)) {
    console.log(`\n  public_api_keys is absent: ${probe.error.message}`);
    // Table-missing tolerance is itself a behaviour worth proving, so assert it
    // here rather than only skipping.
    const state = await resolveKeyState(sb, PUBLIC_PAGES_KEY_ID);
    check('with the table absent, the live key still resolves from the environment (deploy before migrate is safe)',
      state.tableMissing === true && (state.source === 'environment' || state.source === 'none'),
      `tableMissing ${state.tableMissing} source ${state.source}`);
    check('with the table absent, the environment key still verifies',
      process.env.FMP_PUBLIC_API_KEY
        ? (await verifyApiKey(sb, PUBLIC_PAGES_KEY_ID, process.env.FMP_PUBLIC_API_KEY)).ok === true
        : true);
    check('with the table absent, rotation refuses loudly rather than pretending',
      (await rotateApiKey(sb, PROBE_ID, { id: null, email: 'verify@local' })).ok === false);
    skipped('sections 4 to 6 (rotation behaviour)', 'migration 213 has not been applied to this database');
    report();
    return;
  }

  // Leave nothing behind from a previous interrupted run.
  await sb.from('public_api_keys').delete().eq('key_id', PROBE_ID);

  // Snapshot the REAL key id, so section 7 can prove this run did not touch it.
  const liveBefore = JSON.stringify(
    ((await sb.from('public_api_keys').select('id, status, key_prefix, created_at')
      .eq('key_id', PUBLIC_PAGES_KEY_ID).order('created_at', { ascending: true })).data ?? []),
  );

  try {
    // ── 4. Resolution rules ─────────────────────────────────────────────────
    console.log('\n-- 4. Which key is live --');
    const envReader = (): string => PROBE_ENV;

    let state = await resolveKeyState(sb, PROBE_ID, envReader);
    check('with no rows, the environment value is the key', state.source === 'environment', state.source);
    check('and it verifies', (await verifyApiKey(sb, PROBE_ID, PROBE_ENV, envReader)).ok === true);
    check('a wrong key is refused', (await verifyApiKey(sb, PROBE_ID, 'nonsense', envReader)).ok === false);
    check('an empty presented key is refused',
      (await verifyApiKey(sb, PROBE_ID, '', envReader)).reason === 'missing_key');

    const noEnv = (): undefined => undefined;
    const closed = await verifyApiKey(sb, PROBE_ID, 'anything', noEnv);
    check('with no rows AND no environment value, everything is refused',
      closed.ok === false && closed.reason === 'not_configured', closed.reason);
    check('an unregistered key id inherits nothing from the partner feed variable',
      (await resolveKeyState(sb, 'no-such-key-id')).source === 'none');

    // ── 5. Rotation ─────────────────────────────────────────────────────────
    console.log('\n-- 5. Rotation --');
    const r1 = await rotateApiKey(sb, PROBE_ID, { id: null, email: 'verify@local' }, envReader);
    check('the first rotation succeeds', r1.ok === true, r1.ok ? '' : (r1 as any).message);
    if (!r1.ok) throw new Error('rotation failed, cannot continue');

    check('it reports that it superseded the environment key', r1.supersededSource === 'environment', r1.supersededSource);
    check('the new value is returned once, in full', r1.value.startsWith(KEY_TAG) && r1.value.length > KEY_PREFIX_CHARS);

    state = await resolveKeyState(sb, PROBE_ID, envReader);
    check('the live key is now the database row', state.source === 'database', state.source);
    check('the active prefix identifies the new key', state.active?.keyPrefix === r1.prefix, `${state.active?.keyPrefix} vs ${r1.prefix}`);
    check('the new key verifies', (await verifyApiKey(sb, PROBE_ID, r1.value, envReader)).ok === true);

    // THE REQUIREMENT.
    const oldEnv = await verifyApiKey(sb, PROBE_ID, PROBE_ENV, envReader);
    check('THE OLD ENVIRONMENT KEY IS NOW REFUSED', oldEnv.ok === false, `reason ${oldEnv.reason}`);
    check('and the refusal is attributed to the database key, not to a missing configuration',
      oldEnv.source === 'database' && oldEnv.reason === 'wrong_key', `${oldEnv.source} / ${oldEnv.reason}`);

    // Nothing that survives the rotation contains the value.
    const { data: rowsAfter } = await sb.from('public_api_keys').select('*').eq('key_id', PROBE_ID);
    const serialised = JSON.stringify(rowsAfter ?? []);
    check('no stored row contains the key value anywhere', !serialised.includes(r1.value));
    check('the stored row holds the hash of the key', serialised.includes(hashApiKey(r1.value)));
    check('the resolved state never carries a hash to its caller',
      !JSON.stringify(state).includes(hashApiKey(r1.value)));

    // Second rotation.
    const r2 = await rotateApiKey(sb, PROBE_ID, { id: null, email: 'verify@local' }, envReader);
    check('a second rotation succeeds', r2.ok === true);
    if (!r2.ok) throw new Error('second rotation failed');
    check('it names the key it retired', r2.retiredPrefix === r1.prefix, `${r2.retiredPrefix} vs ${r1.prefix}`);
    check('it reports that it superseded a database key', r2.supersededSource === 'database', r2.supersededSource);
    check('THE PREVIOUS ROTATED KEY IS NOW REFUSED', (await verifyApiKey(sb, PROBE_ID, r1.value, envReader)).ok === false);
    check('the newest key verifies', (await verifyApiKey(sb, PROBE_ID, r2.value, envReader)).ok === true);
    check('the two issued keys are different', r1.value !== r2.value);

    const { data: activeRows } = await sb.from('public_api_keys').select('id').eq('key_id', PROBE_ID).eq('status', 'active');
    check('exactly one key is active after two rotations', (activeRows ?? []).length === 1, `${activeRows?.length}`);

    state = await resolveKeyState(sb, PROBE_ID, envReader);
    check('the history lists the retired key', state.retired.length === 1 && state.retired[0].keyPrefix === r1.prefix,
      JSON.stringify(state.retired.map((r) => r.keyPrefix)));
    check('the retired entry carries who retired it', state.retired[0]?.retiredByEmail === 'verify@local');

    // A second active row must be impossible, not merely avoided.
    const dup = await sb.from('public_api_keys').insert({
      key_id: PROBE_ID, key_hash: hashApiKey('duplicate-active-probe'), key_prefix: 'fmp_pk_dupdup', status: 'active',
    });
    check('the database REFUSES a second active key for the same id', dup.error !== null, dup.error?.message ?? 'insert succeeded');

    // ── 6. No resurrection ──────────────────────────────────────────────────
    console.log('\n-- 6. Retiring everything closes the endpoint --');
    await sb.from('public_api_keys')
      .update({ status: 'retired', retired_at: new Date().toISOString() })
      .eq('key_id', PROBE_ID).eq('status', 'active');

    state = await resolveKeyState(sb, PROBE_ID, envReader);
    check('with every key retired, nothing is live', state.source === 'none', state.source);
    const afterRetire = await verifyApiKey(sb, PROBE_ID, PROBE_ENV, envReader);
    check('THE SUPERSEDED ENVIRONMENT KEY IS STILL REFUSED (no resurrection)',
      afterRetire.ok === false, `reason ${afterRetire.reason}`);
    check('and the reason says every key was retired, not that none was configured',
      afterRetire.reason === 'all_keys_retired', afterRetire.reason);
    check('the last rotated key is refused too', (await verifyApiKey(sb, PROBE_ID, r2.value, envReader)).ok === false);

    const r3 = await rotateApiKey(sb, PROBE_ID, { id: null, email: 'verify@local' }, envReader);
    check('rotating out of a fully retired state works', r3.ok === true);
    if (r3.ok) check('and the new key verifies', (await verifyApiKey(sb, PROBE_ID, r3.value, envReader)).ok === true);
  } finally {
    await sb.from('public_api_keys').delete().eq('key_id', PROBE_ID);
    const { data: left } = await sb.from('public_api_keys').select('id').eq('key_id', PROBE_ID);
    check('the probe rows are cleaned up', (left ?? []).length === 0, `${left?.length} left`);
  }

  // ── 7. The live key was not touched ───────────────────────────────────────
  console.log('\n-- 7. The live key was not touched --');
  const liveAfter = JSON.stringify(
    ((await sb.from('public_api_keys').select('id, status, key_prefix, created_at')
      .eq('key_id', PUBLIC_PAGES_KEY_ID).order('created_at', { ascending: true })).data ?? []),
  );
  check('the rows under the REAL key id are byte identical to before this run',
    liveAfter === liveBefore, `${liveBefore.length} chars before, ${liveAfter.length} after`);
  check('and the live key still resolves to something usable',
    ['database', 'environment'].includes((await resolveKeyState(sb, PUBLIC_PAGES_KEY_ID)).source),
    (await resolveKeyState(sb, PUBLIC_PAGES_KEY_ID)).source);

  // ── 8. Route wiring ───────────────────────────────────────────────────────
  console.log('\n-- 8. Route wiring --');
  const pub = read('app/api/public/pages/[slug]/route.ts');
  check('the public route authenticates through the shared resolver',
    /verifyApiKey\(\s*getServerClient\(\),\s*PUBLIC_PAGES_KEY_ID/.test(pub));
  check('the public route no longer compares the environment variable itself',
    !/process\.env\.FMP_PUBLIC_API_KEY/.test(stripComments(pub)), 'the route still reads the env var directly');
  check('the public route still fails closed on a refusal', /error: 'unauthorized'[\s\S]*status: 401/.test(pub));

  const rot = read('app/api/admin/api-keys/rotate/route.ts');
  check('the rotate route is admin guarded', /requireAdmin\(\)/.test(rot));
  check('the rotate route demands an explicit confirmation',
    /body\.confirm !== true/.test(rot) && /confirmation_required/.test(rot));
  check('the rotate route writes an audit row', /action: 'api_key_rotated'/.test(rot));
  check('the audit row records prefixes, never the value',
    /newPrefix: result\.prefix/.test(rot) && !/value: result\.value[\s\S]{0,400}admin_audit_log/.test(rot));
  check('the rotate route resolves the key id from the registry', /findKeyEntry\(id\)/.test(rot));

  const adminRoute = read('app/api/admin/api-keys/route.ts');
  check('the read route refuses to reveal a rotated key', /hashed_not_revealable/.test(adminRoute));
  check('the read route never returns a hash', !/key_hash/.test(adminRoute));
  check('the read route reports which source is live', /source: k\.storeKeyId|source,/.test(adminRoute));

  const registry = read('src/shared/api/apiKeyRegistry.ts');
  check('the registry is still a literal', /REGISTRY: readonly KeyEntry\[\]/.test(registry));
  // Comments stripped: every one of these files documents the pattern it
  // refuses, so prose about process.env[...] is not an occurrence of it.
  for (const [name, src] of [
    ['the registry', registry], ['the read route', adminRoute], ['the rotate route', rot],
  ] as const) {
    check(`${name} never indexes process.env with a value from the request`,
      !/process\.env\s*\[/.test(stripComments(src)));
  }

  const page = read('app/admin/api-keys/page.tsx');
  check('the screen confirms before rotating', /rotate-confirm-yes/.test(page));
  check('the screen warns that the value is shown once', /only time it will be shown/i.test(page));
  check('the one-time value is not put on the auto hide timer',
    !/setIssued\(null\)[^\n]*AUTO_HIDE|hideTimer[\s\S]{0,120}setIssued/.test(page));

  // House rule.
  console.log('\n-- 9. House rules --');
  for (const [name, src] of [
    ['migration 213', mig], ['publicApiKeys.ts', read('src/shared/api/publicApiKeys.ts')],
    ['apiKeyRegistry.ts', registry], ['rotate route', rot], ['read route', adminRoute],
    ['public route', pub], ['admin page', page], ['this verifier', read('scripts/verify-api-key-rotation.ts')],
  ] as const) {
    check(`${name} contains no em dash`, !src.includes(EM_DASH));
  }

  report();
}

function report(): void {
  console.log(`\n=== Result: ${pass} passed, ${fail} failed${skip ? `, ${skip} skipped` : ''} ===`);
  if (failures.length) { console.log('\nFailures:'); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
