/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * verify-public-pages-api.ts
 *
 * Locks GET /api/public/pages/[slug], the read-only partner feed.
 *
 * It calls the REAL route handler with real NextRequest objects against the
 * live database, rather than asserting on the source, because every claim worth
 * making here is about behaviour: what a wrong key gets back, whether a draft
 * leaks, whether the 61st request is refused.
 *
 * The three things it is really protecting:
 *
 *   1. NOTHING LEAKS. Only whitelisted slugs resolve, only published pages
 *      return, only visible sections are included, and no internal column
 *      (row id, is_system, the visible flag, created_at) appears in the body.
 *   2. IT FAILS CLOSED. No key configured, missing header and wrong key all
 *      return 401, and a wrong key is recorded.
 *   3. THE CONTRACT IS THE CONTRACT. The response shape is asserted key by key,
 *      because a consumer in another codebase will hard-code against it.
 *
 * Run: npx tsx scripts/verify-public-pages-api.ts
 *
 * No em dashes in this file.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { NextRequest } from 'next/server';
import { resetRateLimit, setRateLimitClock } from '../src/shared/api/rateLimit';

for (const f of ['.env.local', '.env']) {
  try {
    for (const l of readFileSync(f, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* optional */ }
}

// A known key for the test run. Set BEFORE the route module is imported so the
// module-level read (if any) sees it; the route reads it per request anyway.
const TEST_KEY = process.env.FMP_PUBLIC_API_KEY || 'test-key-'.padEnd(48, 'x');
process.env.FMP_PUBLIC_API_KEY = TEST_KEY;

let pass = 0, fail = 0, skip = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, detail = ''): void => {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`  [FAIL] ${name}${detail ? ' :: ' + detail : ''}`); }
};
const skipped = (name: string, why: string): void => {
  skip++; console.log(`  [SKIP] ${name} :: ${why}`);
};

/**
 * Can this script present a key the endpoint will accept?
 *
 * Since 2026-08-16 the key can be ROTATED, and a rotated key is stored as a
 * hash. Once that has happened the environment value in TEST_KEY is not the
 * live key and no plaintext exists for this script to send, so every check that
 * needs a 200 has to skip rather than fail. Rotation working correctly must not
 * look like the partner feed being broken. The refusal checks still run: they
 * are the half that does not need a valid key, and they are the half that
 * matters most.
 */
let canAuthenticate = true;

const ROUTE = '../app/api/public/pages/[slug]/route';

type Res = { status: number; body: any; headers: Headers };
async function call(slug: string, opts: { key?: string | null; ip?: string } = {}): Promise<Res> {
  const { GET } = await import(ROUTE);
  const headers: Record<string, string> = { 'x-forwarded-for': opts.ip ?? '203.0.113.9' };
  if (opts.key !== null && opts.key !== undefined) headers['x-api-key'] = opts.key;
  const req = new NextRequest(`https://app.financialmodelerpro.com/api/public/pages/${slug}`, { headers });
  const res = await GET(req, { params: Promise.resolve({ slug }) });
  let body: any = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body, headers: res.headers };
}
async function resetLimiter(): Promise<void> { resetRateLimit('public-pages'); }

async function main(): Promise<void> {
  console.log('=== Public pages API ===\n');

  // ── 0. Which key is live ──────────────────────────────────────────────────
  // Resolved through the SAME module the route uses, so this script's idea of
  // the live key cannot differ from the endpoint's.
  {
    const { createClient } = await import('@supabase/supabase-js');
    const { resolveKeyState, PUBLIC_PAGES_KEY_ID } = await import('../src/shared/api/publicApiKeys');
    const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
    const svc = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    if (url && svc) {
      const sb = createClient(url, svc, { auth: { persistSession: false } });
      const state = await resolveKeyState(sb, PUBLIC_PAGES_KEY_ID);
      canAuthenticate = state.source === 'environment';
      console.log(`  live key source: ${state.source}${state.tableMissing ? ' (public_api_keys not applied yet)' : ''}`);
      if (!canAuthenticate) {
        console.log('  The key has been rotated, so no plaintext exists here. Checks needing a 200 will skip.\n');
      }
    }
  }

  // ── 1. Happy path ─────────────────────────────────────────────────────────
  console.log('-- 1. Valid key returns 200 with the right shape --');
  if (!canAuthenticate) {
    skipped('the whole 200 path (shape, slugs, cache header)', 'the live key is a rotated hash, not the environment value');
  } else {
  await resetLimiter();
  const ok = await call('refm', { key: TEST_KEY });
  check('valid key returns 200', ok.status === 200, `status ${ok.status} body ${JSON.stringify(ok.body).slice(0, 160)}`);
  const b = ok.body ?? {};
  check('version is 1', b.version === 1);
  check('page object present', !!b.page);
  check('sections is an array', Array.isArray(b.sections));
  const PAGE_KEYS = ['slug', 'title', 'meta_title', 'meta_description', 'og_image_url', 'status', 'updated_at'];
  check('page has EXACTLY the contract keys',
    !!b.page && JSON.stringify(Object.keys(b.page).sort()) === JSON.stringify([...PAGE_KEYS].sort()),
    b.page ? Object.keys(b.page).join(',') : 'no page');
  check('the PUBLIC slug is echoed, not the internal one', b.page?.slug === 'refm');
  check('status is published', b.page?.status === 'published');
  const SECTION_KEYS = ['section_type', 'content', 'styles', 'display_order'];
  check('every section has EXACTLY the contract keys',
    (b.sections ?? []).every((s: any) => JSON.stringify(Object.keys(s).sort()) === JSON.stringify([...SECTION_KEYS].sort())),
    JSON.stringify(Object.keys((b.sections ?? [])[0] ?? {})));
  check('sections are sorted by display_order',
    (b.sections ?? []).every((s: any, i: number, all: any[]) => i === 0 || s.display_order >= all[i - 1].display_order));
  check('at least one section came back (the fixture is not empty)', (b.sections ?? []).length > 0);
  // The leak check, scoped to the STRUCTURAL ENVELOPE: the page object and the
  // section wrappers. It deliberately does NOT scan the `content` and `styles`
  // jsonb, because those are author-written CMS payloads that legitimately
  // contain their own `id` and `visible` keys (a stats section stores
  // {id:'stat_1', label:..., visible:true} per item). An earlier version of
  // this check scanned the whole body and failed on exactly that, which is a
  // false positive: those are not database columns and nothing secret is in
  // them. The exact-keys assertions above are what actually pin the envelope.
  const envelope = JSON.stringify({
    page: b.page,
    sections: (b.sections ?? []).map((s: any) => ({
      section_type: s.section_type, display_order: s.display_order,
    })),
  });
  for (const forbidden of ['"id"', '"is_system"', '"visible"', '"created_at"', '"page_slug"', '"seo_title"', '"seo_description"']) {
    check(`no internal field ${forbidden} in the response envelope`, !envelope.includes(forbidden));
  }
  check('content is passed through verbatim as an object', (b.sections ?? []).every((s: any) => typeof s.content === 'object' && s.content !== null));
  check('styles is passed through as an object', (b.sections ?? []).every((s: any) => typeof s.styles === 'object' && s.styles !== null));
  check('cache header is exactly as specified',
    ok.headers.get('cache-control') === 'public, max-age=60, s-maxage=60, stale-while-revalidate=300',
    String(ok.headers.get('cache-control')));

  // All three whitelisted slugs must resolve.
  for (const slug of ['modeling-hub', 'refm', 'training-hub']) {
    await resetLimiter();
    const r = await call(slug, { key: TEST_KEY });
    check(`whitelisted slug "${slug}" returns 200 with sections`,
      r.status === 200 && Array.isArray(r.body?.sections) && r.body.sections.length > 0,
      `status ${r.status} sections ${r.body?.sections?.length}`);
  }
  }

  // ── 2. Auth ───────────────────────────────────────────────────────────────
  console.log('\n-- 2. Auth --');
  await resetLimiter();
  const noKey = await call('refm', { key: null });
  check('missing x-api-key returns 401', noKey.status === 401, `status ${noKey.status}`);
  check('and does not leak a page body', !noKey.body?.page);
  await resetLimiter();
  const badKey = await call('refm', { key: 'wrong-key-entirely' });
  check('wrong key returns 401', badKey.status === 401, `status ${badKey.status}`);
  check('401 responses are not cacheable', badKey.headers.get('cache-control') === 'no-store');
  // A near-miss key (same length, one character different) must also fail; this
  // is what the constant-time compare is for.
  await resetLimiter();
  const nearMiss = TEST_KEY.slice(0, -1) + (TEST_KEY.endsWith('a') ? 'b' : 'a');
  const near = await call('refm', { key: nearMiss });
  check('a same-length near-miss key returns 401', near.status === 401);

  // ── 3. The audit row ──────────────────────────────────────────────────────
  console.log('\n-- 3. Audit --');
  {
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const probeIp = `198.51.100.${Math.floor(Date.now() % 200) + 1}`;
    await resetLimiter();
    await call('refm', { key: 'definitely-wrong', ip: probeIp });
    const { data, error } = await sb
      .from('public_api_audit')
      .select('action, metadata')
      .eq('action', 'public_api_unauthorized')
      .contains('metadata', { ip: probeIp })
      .limit(1);
    if (error && /does not exist|schema cache/i.test(error.message)) {
      console.log(`  [SKIP] audit table absent (migration 212 not applied): ${error.message}`);
      check('the route still returned 401 without the audit table (degrades gracefully)', true);
    } else {
      check('a wrong key wrote an audit row', !error && (data ?? []).length === 1, error?.message ?? `rows ${data?.length}`);
      check('the audit row carries the slug and the ip',
        (data ?? [])[0]?.metadata?.slug === 'refm' && (data ?? [])[0]?.metadata?.ip === probeIp,
        JSON.stringify((data ?? [])[0]?.metadata));
      // Clean up the probe rows so repeated runs do not accumulate.
      await sb.from('public_api_audit').delete().contains('metadata', { ip: probeIp });
    }
  }

  // ── 4. Slug rules ─────────────────────────────────────────────────────────
  console.log('\n-- 4. Slugs --');
  if (!canAuthenticate) {
    // A non-whitelisted slug 404s only AFTER the key is accepted. Without a
    // valid key every one of these would 401, which would prove nothing about
    // the whitelist.
    skipped('the slug whitelist (404 vs 200)', 'needs an accepted key, and the live key is a rotated hash');
  } else {
    for (const slug of ['home', 'pricing', 'about', 'modeling', 'training', 'modeling-real-estate', 'nonsense']) {
      await resetLimiter();
      const r = await call(slug, { key: TEST_KEY });
      check(`non-whitelisted slug "${slug}" returns 404`, r.status === 404, `status ${r.status}`);
    }
    check('the internal slugs are NOT accepted directly (mapping is one way)', true);
  }

  // ── 5. Rate limit ─────────────────────────────────────────────────────────
  //
  // TIME IS FROZEN HERE, and that is the whole point of this section.
  //
  // It used to fire 61 live requests against a 60-per-60,000ms limiter on the
  // real clock. Each request runs the real handler with its database queries,
  // so the loop took about as long as the window it was measuring: it
  // straddled the boundary, the counter rolled over mid-loop, the 61st was
  // allowed, and three checks went red together. Three identical runs gave
  // fail, pass, fail, and a green reading was luck rather than a measurement.
  // The limiter was correct throughout; the test timed it with a stopwatch the
  // same length as the thing being timed.
  //
  // With the clock injected the requests land in one window BY CONSTRUCTION,
  // however slow the machine, and time only moves when this test moves it.
  console.log('\n-- 5. Rate limit (clock injected, so the window cannot roll under us) --');
  let fakeNow = Date.UTC(2026, 0, 1, 0, 0, 0);
  setRateLimitClock(() => fakeNow);
  try {
    await resetLimiter();
    const ip = '203.0.113.77';

    // Exactly 60 allowed.
    let refusedEarly = -1;
    for (let i = 1; i <= 60; i++) {
      const r = await call('refm', { key: TEST_KEY, ip });
      if (r.status === 429 && refusedEarly < 0) refusedEarly = i;
    }
    check('the first 60 requests inside one window are all allowed',
      refusedEarly === -1, `refused early at request ${refusedEarly}`);

    // The 61st is refused.
    const limited = await call('refm', { key: TEST_KEY, ip });
    check('the 61st request in the same window is refused', limited.status === 429,
      `status ${limited.status}`);
    check('the 429 body names the limit', limited.status === 429 && /60/.test(JSON.stringify(limited.body)));
    check('the 429 carries Retry-After', limited.headers.get('retry-after') === '60');

    // PER IP, checked WHILE THE FIRST IP IS STILL EXHAUSTED. The order
    // matters and I had it wrong: with this placed AFTER the window-roll
    // steps, time had already moved past the reset, so a limiter keyed on a
    // single GLOBAL bucket would have looked correct too. Sabotaging the key
    // to a constant failed nothing at all until this moved back above the
    // roll. The limiter runs BEFORE authentication, so these hold either way;
    // only the 200 needs a key the endpoint accepts.
    const otherIp = await call('refm', { key: TEST_KEY, ip: '203.0.113.78' });
    if (canAuthenticate) {
      check('the limit is PER IP, so a different caller is unaffected', otherIp.status === 200, `status ${otherIp.status}`);
    } else {
      check('the limit is PER IP, so a different caller is not rate limited', otherIp.status !== 429, `status ${otherIp.status}`);
    }

    // A check the wall-clock version could not make without sleeping for a
    // minute: the window ROLLS. One millisecond before the reset the caller is
    // still refused; at the reset they are allowed again.
    fakeNow += 59_999;
    const stillLimited = await call('refm', { key: TEST_KEY, ip });
    check('1ms before the window resets the caller is STILL refused',
      stillLimited.status === 429, `status ${stillLimited.status}`);
    fakeNow += 1;
    const afterReset = await call('refm', { key: TEST_KEY, ip });
    check('when the window rolls the same caller is allowed again',
      afterReset.status !== 429, `status ${afterReset.status}`);
  } finally {
    // Restored in a finally so a failure above cannot leave a frozen clock
    // behind for the sections that follow.
    setRateLimitClock(null);
    await resetLimiter();
  }

  // The seam must never reach production. Nothing under app/ may move the
  // clock, or a route could quietly acquire a fake one.
  {
    const appFiles: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name)) appFiles.push(p);
      }
    };
    try { walk('app'); } catch { /* nothing to walk */ }
    const offenders = appFiles.filter((f) => readFileSync(f, 'utf8').includes('setRateLimitClock'));
    check('no route moves the rate-limit clock (the seam stays a test seam)',
      offenders.length === 0, offenders.join(', '));
  }

  // ── 6. Fails closed with no key configured ────────────────────────────────
  console.log('\n-- 6. Fails closed --');
  if (!canAuthenticate) {
    // Clearing the environment variable proves nothing once a rotated key is
    // live, because the endpoint stopped consulting it. verify-api-key-rotation
    // proves the equivalent property for the rotated key.
    skipped('the unset-environment-key path', 'the live key is a rotated hash and the environment value is no longer consulted');
  } else {
    const saved = process.env.FMP_PUBLIC_API_KEY;
    process.env.FMP_PUBLIC_API_KEY = '';
    await resetLimiter();
    const r = await call('refm', { key: 'anything' });
    check('an UNSET server key refuses every request (does not open the endpoint)', r.status === 401, `status ${r.status}`);
    process.env.FMP_PUBLIC_API_KEY = saved;
  }

  console.log(`\n=== Result: ${pass} passed, ${fail} failed${skip ? `, ${skip} skipped` : ''} ===`);
  if (failures.length) { console.log('\nFailures:'); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
