import { NextRequest, NextResponse } from 'next/server';
import { serverClient, getServerClient } from '@/src/core/db/supabase';
import { findKeyEntry, requireAdmin, noStore } from '@/src/shared/api/apiKeyRegistry';
import { rotateApiKey } from '@/src/shared/api/publicApiKeys';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/api-keys/rotate
 *
 * Issues a new key for a registry entry and kills the old one in the same
 * transaction.
 *
 * ── WHY THIS IS ITS OWN ROUTE ──────────────────────────────────────────────
 *
 * Reading a key and destroying a partner's access are not variations of one
 * action. Folding rotation into the reveal handler behind a body flag would put
 * them one typo apart, and the permission dialog, the audit action and the
 * client call would all have to carry the distinction anyway.
 *
 * ── THE CUTOVER IS IMMEDIATE, AND THAT IS THE POINT ────────────────────────
 *
 * There is no overlap window. The moment this returns, the previous key is
 * refused: the public route resolves the active row on every request with no
 * cache, and the database allows at most one active row per key id. The partner
 * will get 401s until they paste the new value. That is rotation working, not
 * rotation misfiring, and the response says so in terms the screen can show.
 *
 * ── THE VALUE IS RETURNED EXACTLY ONCE ─────────────────────────────────────
 *
 * Only a SHA-256 hash is stored, so this response is the only moment the new
 * key exists anywhere but the admin's clipboard. If it is lost, the answer is
 * to rotate again, not to recover it, because recovery would mean the database
 * held something worth stealing.
 *
 * No em dashes in this file.
 */

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.res;

  let body: { id?: unknown; confirm?: unknown } = {};
  try { body = await req.json(); } catch { /* handled below */ }
  const id = typeof body.id === 'string' ? body.id : '';

  const entry = findKeyEntry(id);
  if (!entry) {
    return NextResponse.json({ error: 'unknown_key' }, { status: 404, headers: noStore });
  }
  if (!entry.storeKeyId) {
    // An environment-only key in the registry cannot be rotated from here, and
    // pretending otherwise would generate a value that nothing consults.
    return NextResponse.json({ error: 'not_rotatable', envVar: entry.envVar }, { status: 409, headers: noStore });
  }

  // An explicit confirmation in the request body, so a rotation cannot happen
  // by a bare POST from a stray fetch, a retried request or a curl that was
  // meant to be a GET. The dialog in the UI is the human half of the same idea.
  if (body.confirm !== true) {
    return NextResponse.json({ error: 'confirmation_required' }, { status: 400, headers: noStore });
  }

  const result = await rotateApiKey(getServerClient(), entry.storeKeyId, {
    id: auth.userId || null,
    email: auth.email,
  });

  if (!result.ok) {
    const status = result.error === 'table_missing' ? 503 : 500;
    console.error('[api-keys] rotation failed:', result.error, result.message);
    return NextResponse.json({ error: result.error, message: result.message }, { status, headers: noStore });
  }

  // ── The audit row ──────────────────────────────────────────────────────────
  // Written AFTER the rotation, and it records PREFIXES only. A trail that
  // carried the value would be a second place the secret lives, which is the
  // thing hashing the key was for.
  //
  // Best effort, exactly like the reveal path: a logging outage must not make
  // an admin believe a rotation failed when the old key is already dead. It is
  // logged loudly instead, so a gap in the trail is visible in the server logs.
  let audited = true;
  try {
    const { error } = await serverClient.from('admin_audit_log').insert({
      admin_id: auth.userId || null,
      action: 'api_key_rotated',
      before_value: {
        keyId: entry.id,
        supersededSource: result.supersededSource,
        retiredPrefix: result.retiredPrefix,
      },
      after_value: {
        keyId: entry.id,
        newPrefix: result.prefix,
        by: auth.email,
      },
      reason: 'Rotated in Admin > API Keys. The previous key was refused from this moment.',
    });
    if (error) { audited = false; console.warn('[api-keys] rotation audit insert failed:', error.message); }
  } catch (e) {
    audited = false;
    console.warn('[api-keys] rotation audit insert threw:', (e as Error).message);
  }

  return NextResponse.json(
    {
      id: entry.id,
      // The one and only disclosure of this value.
      value: result.value,
      prefix: result.prefix,
      retiredPrefix: result.retiredPrefix,
      supersededSource: result.supersededSource,
      envVar: entry.envVar,
      audited,
    },
    { headers: noStore },
  );
}
