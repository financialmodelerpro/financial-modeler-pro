import { NextRequest, NextResponse } from 'next/server';
import { serverClient, getServerClient } from '@/src/core/db/supabase';
import { findKeyEntry, requireAdmin, REGISTRY, noStore } from '@/src/shared/api/apiKeyRegistry';
import { resolveKeyState, type KeyState } from '@/src/shared/api/publicApiKeys';

export const dynamic = 'force-dynamic';

/**
 * /api/admin/api-keys
 *
 * Lets an admin see, copy and rotate the shared secrets the platform hands to
 * partners, without opening the Vercel dashboard or a local env file.
 *
 * The registry that decides WHICH secrets are reachable, and the admin guard,
 * live in src/shared/api/apiKeyRegistry.ts, because the rotate route needs both
 * and a route.ts cannot export them.
 *
 * ── WHAT EACH METHOD RETURNS ───────────────────────────────────────────────
 *
 * GET  metadata only: which key is live and where it came from, its prefix, its
 *      rotation history, how many characters an environment key is, what it
 *      grants, where the endpoint lives. NO PART of any value, not even a
 *      last-four suffix, because the brief was that the value reaches the
 *      client only on an explicit reveal and a suffix is still the value. A key
 *      PREFIX is different in kind: it is stored precisely so a key can be
 *      identified without being disclosed, and it is useless on its own.
 *
 * POST the value, once, for a named registry entry, AND an audit row. Copying
 *      is a read, so the copy button goes through this same path rather than a
 *      quieter one: there is no way to get the secret out of here without
 *      leaving a record.
 *
 *      REVEAL ONLY WORKS FOR AN ENVIRONMENT KEY, and that is not a limitation
 *      to be fixed. A rotated key is stored as a SHA-256 hash, so there is
 *      nothing here to reveal: the value existed for exactly one response, at
 *      rotation. This route says so plainly rather than returning an empty
 *      string that would read as a broken button.
 *
 * Rotation lives at POST /api/admin/api-keys/rotate, a separate route because
 * it is a WRITE that invalidates a live credential, and folding it into the
 * reveal handler behind a body flag would put "show me the key" and "break the
 * partner's integration" one typo apart.
 *
 * Both responses are no-store. A secret must not sit in a CDN or a browser
 * cache, and `force-dynamic` keeps the route off the prerender path.
 *
 * No em dashes in this file.
 */

/**
 * One sentence an admin can act on, describing what the endpoint will accept
 * right now. Derived from the SAME resolution the public route runs, so the
 * screen cannot describe a key the endpoint would refuse.
 */
function describeSource(state: KeyState, envVar: string): string {
  if (state.readError) {
    return 'The key store could not be read, so the endpoint is refusing every request. It does not fall back to the environment value, because that would resurrect a key a rotation retired.';
  }
  switch (state.source) {
    case 'database':
      return `Rotated key, live from the database. ${envVar} is no longer consulted and can be removed from the deployment.`;
    case 'environment':
      return `Live from ${envVar} in the deployment environment. It has never been rotated. Rotating issues a key in the database and retires this one permanently.`;
    case 'none':
      return state.retired.length > 0
        ? 'Every key has been retired and no replacement is active, so the endpoint refuses every request. Rotate to issue a new one.'
        : `No key is configured. ${envVar} is unset and no key has been issued, so the endpoint refuses every request. It fails closed by design.`;
  }
}

/**
 * GET: every registered key, described but not disclosed.
 *
 * `configured` answers the question that matters operationally, "will the
 * endpoint accept anything at all", rather than the narrower "is the env var
 * set", which stopped being the same question once a key could be rotated.
 */
export async function GET(): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.res;

  const sb = getServerClient();

  const keys = await Promise.all(REGISTRY.map(async (k) => {
    const envValue = k.read();
    const envConfigured = typeof envValue === 'string' && envValue.length > 0;

    const state: KeyState | null = k.storeKeyId ? await resolveKeyState(sb, k.storeKeyId) : null;
    const source = state ? state.source : (envConfigured ? 'environment' : 'none');

    return {
      id: k.id,
      label: k.label,
      envVar: k.envVar,
      consumer: k.consumer,
      endpointPath: k.endpointPath,
      transport: k.transport,
      grants: k.grants,
      caveat: k.caveat ?? null,
      slugs: k.slugs ?? [],

      // ── What is live ─────────────────────────────────────────────────────
      source,
      configured: source !== 'none',
      sourceNote: state ? describeSource(state, k.envVar) : '',
      // Length only, and only for an environment key. Enough for an admin to
      // sanity check that the deployed value looks like the key they set.
      envConfigured,
      length: envConfigured ? envValue!.length : 0,

      // ── The rotated key, identified but not disclosed ────────────────────
      activePrefix: state?.active?.keyPrefix ?? null,
      activeCreatedAt: state?.active?.createdAt ?? null,
      activeCreatedBy: state?.active?.createdByEmail ?? null,
      retired: (state?.retired ?? []).map((r) => ({
        keyPrefix: r.keyPrefix,
        createdAt: r.createdAt,
        retiredAt: r.retiredAt,
        retiredBy: r.retiredByEmail,
      })),

      // ── What the UI may offer ────────────────────────────────────────────
      rotatable: Boolean(k.storeKeyId),
      // A hash cannot be revealed. Saying so as a field means the button can be
      // absent rather than present and failing.
      revealable: source === 'environment',
      rotationUnavailable: state?.tableMissing ? 'migration_213_not_applied' : null,
      keyStoreError: state?.readError ?? null,
      failsClosed: true,
    };
  }));

  return NextResponse.json({ keys }, { headers: noStore });
}

/**
 * POST: reveal one key by registry id, and record that it happened.
 *
 * The audit write is BEST EFFORT and deliberately cannot fail the request: a
 * logging outage should not lock an admin out of their own key. It is logged
 * loudly instead, so a silent gap in the trail is visible in the server logs.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.res;

  let body: { id?: unknown } = {};
  try { body = await req.json(); } catch { /* empty body is a bad request below */ }
  const id = typeof body.id === 'string' ? body.id : '';

  const entry = findKeyEntry(id);
  if (!entry) {
    return NextResponse.json({ error: 'unknown_key' }, { status: 404, headers: noStore });
  }

  // A rotated key is a hash. There is nothing to reveal and never will be, so
  // this is a distinct answer from "not configured": the endpoint is working
  // perfectly, the value is simply gone by design.
  if (entry.storeKeyId) {
    const state = await resolveKeyState(getServerClient(), entry.storeKeyId);
    if (state.readError) {
      return NextResponse.json({ error: 'key_store_unreadable', message: state.readError }, { status: 503, headers: noStore });
    }
    if (state.source === 'database') {
      return NextResponse.json(
        { error: 'hashed_not_revealable', prefix: state.active?.keyPrefix ?? null },
        { status: 409, headers: noStore },
      );
    }
    if (state.source === 'none') {
      return NextResponse.json(
        { error: state.retired.length > 0 ? 'all_keys_retired' : 'not_configured', envVar: entry.envVar },
        { status: 409, headers: noStore },
      );
    }
  }

  const value = entry.read();
  if (!value) {
    return NextResponse.json(
      { error: 'not_configured', envVar: entry.envVar },
      { status: 409, headers: noStore },
    );
  }

  try {
    const { error } = await serverClient.from('admin_audit_log').insert({
      admin_id: auth.userId || null,
      action: 'api_key_revealed',
      after_value: { keyId: entry.id, envVar: entry.envVar, by: auth.email },
      reason: 'Viewed or copied in Admin > API Keys',
    });
    if (error) console.warn('[api-keys] audit insert failed:', error.message);
  } catch (e) {
    console.warn('[api-keys] audit insert threw:', (e as Error).message);
  }

  return NextResponse.json({ id: entry.id, value }, { headers: noStore });
}
