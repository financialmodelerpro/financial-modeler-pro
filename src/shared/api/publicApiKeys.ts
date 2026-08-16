/**
 * publicApiKeys.ts
 *
 * The one place that decides what the live partner feed key IS, and the one
 * place that can change it.
 *
 * The public endpoint, the admin screen and the verifiers all resolve through
 * here, so "which key is live" cannot be answered differently in two files. It
 * was one env read in one route until rotation existed; the moment a second
 * source appeared, a shared resolver became the only way to keep the screen
 * honest about what the endpoint will actually accept.
 *
 * ── THE RESOLUTION RULE ────────────────────────────────────────────────────
 *
 * The environment variable is consulted ONLY when the table holds NO ROW AT ALL
 * for this key id. Not "no active row": no row.
 *
 *   no rows        -> the environment value is the key (today, before rotation)
 *   table absent   -> same, because prod applies migrations after the deploy
 *   an active row  -> that row is the key, the environment is never read
 *   only retired   -> NOTHING is the key, and the endpoint refuses everyone
 *
 * That last line is the important one. If a retired-only state fell back to the
 * environment, retiring a key would silently resurrect the value it superseded,
 * which is the exact opposite of what someone rotating a credential wants. It
 * fails closed instead.
 *
 * ── ONLY A HASH IS STORED ──────────────────────────────────────────────────
 *
 * A rotated key exists in plaintext for exactly one HTTP response. After that
 * only its SHA-256 and a short prefix survive, so this module can verify a key
 * and can never reveal one.
 *
 * No em dashes in this file.
 */

import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Registry id of the partner feed key. Never an environment variable name. */
export const PUBLIC_PAGES_KEY_ID = 'fmp-public-pages';

/** Human-visible tag on every generated key, so a leaked string is identifiable. */
export const KEY_TAG = 'fmp_pk_';

/** Random bytes behind a generated key. 32 bytes is 256 bits of entropy. */
const KEY_BYTES = 32;

/**
 * How much of the key is kept as the display prefix. It spans the fixed tag
 * plus a few random characters: enough for an admin to match the live key
 * against what the partner holds, far too little to guess the rest.
 */
export const KEY_PREFIX_CHARS = 14;

/** Where the live key came from. */
export type KeySource = 'database' | 'environment' | 'none';

/** The active row, described without disclosing anything. */
export interface ActiveKeyInfo {
  id: string;
  keyPrefix: string;
  createdAt: string;
  createdByEmail: string | null;
}

/** A superseded key, for the rotation history on the admin screen. */
export interface RetiredKeyInfo {
  id: string;
  keyPrefix: string;
  createdAt: string;
  retiredAt: string | null;
  retiredByEmail: string | null;
}

export interface KeyState {
  source: KeySource;
  active: ActiveKeyInfo | null;
  /** Rotation history, newest first. Empty before the first rotation. */
  retired: RetiredKeyInfo[];
  /** Whether the env variable holds a value, whether or not it is still used. */
  envConfigured: boolean;
  envLength: number;
  /** True when migration 213 has not been applied to this deployment yet. */
  tableMissing: boolean;
  /**
   * Set when the table could not be read for a reason that is NOT "not applied
   * yet". Callers must treat this as a refusal, never as an empty table.
   */
  readError: string | null;
}

/**
 * The environment variable that backs a key id BEFORE its first rotation.
 *
 * A map rather than a bare `process.env` read inside the resolver, because the
 * resolver is generic over key ids and an unregistered id must fall back to
 * NOTHING rather than silently inheriting the partner feed's variable.
 */
const ENV_FALLBACK: Readonly<Record<string, () => string | undefined>> = {
  [PUBLIC_PAGES_KEY_ID]: () => process.env.FMP_PUBLIC_API_KEY,
};

/**
 * Reader for a key id's pre-rotation environment value.
 *
 * Every public function here takes one as an optional last argument. Production
 * never passes it (the map above is the answer); the verifier does, so it can
 * exercise the environment branch under a probe key id instead of rotating the
 * live partner key to prove a code path.
 */
export type EnvReader = () => string | undefined;

/** A new key, in the only moment it exists in plaintext. */
export interface GeneratedKey {
  value: string;
  hash: string;
  prefix: string;
}

// ── Primitives ───────────────────────────────────────────────────────────────

/** A fresh key. base64url so it survives a header, a URL and a copy paste. */
export function generateApiKey(): string {
  return KEY_TAG + randomBytes(KEY_BYTES).toString('base64url');
}

/** SHA-256 hex. What the table stores, and all it stores. */
export function hashApiKey(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** The identifying head of a key. */
export function keyPrefix(value: string): string {
  return value.slice(0, KEY_PREFIX_CHARS);
}

export function generateKeyRecord(): GeneratedKey {
  const value = generateApiKey();
  return { value, hash: hashApiKey(value), prefix: keyPrefix(value) };
}

/**
 * Constant-time string comparison, so a wrong key cannot be discovered by
 * timing. timingSafeEqual throws on a length mismatch, and a length is not a
 * secret worth protecting here, so the guard returns false rather than throwing.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Does this error mean migration 213 has not been applied, as opposed to the
 * database being unreachable or unhappy?
 *
 * The distinction is load bearing. "Not applied yet" falls back to the
 * environment so a deploy that lands before the migration keeps the partner
 * working. Anything else must refuse, because treating a failed read as an
 * empty table would fall back to an environment key that rotation retired.
 */
function isTableMissing(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  // 42P01 is undefined_table; PGRST205 is PostgREST's schema cache miss.
  if (err.code === '42P01' || err.code === 'PGRST205') return true;
  return /does not exist|schema cache|could not find the table/i.test(err.message ?? '');
}

// ── Reading the live state ───────────────────────────────────────────────────

interface KeyRow {
  id: string;
  key_hash: string;
  key_prefix: string;
  status: string;
  created_at: string;
  created_by_email: string | null;
  retired_at: string | null;
  retired_by_email: string | null;
}

/** Every row for a key id, newest first. Schema tolerant by design. */
async function loadRows(
  sb: SupabaseClient,
  keyId: string,
): Promise<{ rows: KeyRow[]; tableMissing: boolean; readError: string | null }> {
  const { data, error } = await sb
    .from('public_api_keys')
    .select('id, key_hash, key_prefix, status, created_at, created_by_email, retired_at, retired_by_email')
    .eq('key_id', keyId)
    .order('created_at', { ascending: false });

  if (error) {
    if (isTableMissing(error)) return { rows: [], tableMissing: true, readError: null };
    return { rows: [], tableMissing: false, readError: error.message };
  }
  return { rows: (data ?? []) as KeyRow[], tableMissing: false, readError: null };
}

/**
 * The resolution, plus the active hash.
 *
 * The hash is returned SEPARATELY from KeyState and never becomes a field on
 * it, because KeyState is what the admin route serialises into a JSON response
 * and a hash has no business sitting one spread operator away from that.
 */
async function resolveInternal(
  sb: SupabaseClient,
  keyId: string,
  envReader?: EnvReader,
): Promise<{ state: KeyState; activeHash: string }> {
  const envValue = (envReader ?? ENV_FALLBACK[keyId] ?? (() => undefined))() ?? '';
  const envConfigured = envValue.length > 0;
  const { rows, tableMissing, readError } = await loadRows(sb, keyId);

  const activeRow = rows.find((r) => r.status === 'active') ?? null;
  const active: ActiveKeyInfo | null = activeRow
    ? {
        id: activeRow.id,
        keyPrefix: activeRow.key_prefix,
        createdAt: activeRow.created_at,
        createdByEmail: activeRow.created_by_email,
      }
    : null;

  const retired: RetiredKeyInfo[] = rows
    .filter((r) => r.status === 'retired')
    .map((r) => ({
      id: r.id,
      keyPrefix: r.key_prefix,
      createdAt: r.created_at,
      retiredAt: r.retired_at,
      retiredByEmail: r.retired_by_email,
    }));

  let source: KeySource;
  if (readError) {
    // Unreadable is not empty. Refuse rather than fall back.
    source = 'none';
  } else if (active) {
    source = 'database';
  } else if (rows.length > 0) {
    // Retired only. The environment key was superseded and stays superseded.
    source = 'none';
  } else {
    source = envConfigured ? 'environment' : 'none';
  }

  return {
    state: { source, active, retired, envConfigured, envLength: envValue.length, tableMissing, readError },
    activeHash: activeRow?.key_hash ?? '',
  };
}

/**
 * What the endpoint will accept right now, and where it came from.
 *
 * The admin screen renders this directly, which is the point: the screen states
 * the resolution the endpoint performs, rather than a second opinion about it.
 */
export async function resolveKeyState(
  sb: SupabaseClient,
  keyId: string,
  envReader?: EnvReader,
): Promise<KeyState> {
  const { state } = await resolveInternal(sb, keyId, envReader);
  return state;
}

export type VerifyReason =
  | 'ok'
  | 'missing_key'
  | 'wrong_key'
  | 'not_configured'
  | 'all_keys_retired'
  | 'key_store_unreadable';

export interface VerifyResult {
  ok: boolean;
  source: KeySource;
  reason: VerifyReason;
}

/**
 * Verify a presented key against whatever is live.
 *
 * NOT CACHED, deliberately. An in-memory cache would let a retired key keep
 * working on a warm serverless instance for the length of its TTL, which is
 * precisely what rotation is supposed to make impossible. This is one indexed
 * read on a route that already makes two queries and is capped at 60 requests
 * per minute per IP, so exactness is affordable.
 */
export async function verifyApiKey(
  sb: SupabaseClient,
  keyId: string,
  provided: string,
  envReader?: EnvReader,
): Promise<VerifyResult> {
  const { state, activeHash } = await resolveInternal(sb, keyId, envReader);

  if (state.readError) return { ok: false, source: 'none', reason: 'key_store_unreadable' };
  if (state.source === 'none') {
    const reason: VerifyReason = state.retired.length > 0 ? 'all_keys_retired' : 'not_configured';
    return { ok: false, source: 'none', reason };
  }
  if (!provided) return { ok: false, source: state.source, reason: 'missing_key' };

  if (state.source === 'database') {
    // Both sides are 64 hex characters, so the compare is always same-length.
    const match = constantTimeEqual(hashApiKey(provided), activeHash);
    return { ok: match, source: 'database', reason: match ? 'ok' : 'wrong_key' };
  }

  const envValue = (envReader ?? ENV_FALLBACK[keyId] ?? (() => undefined))() ?? '';
  const match = constantTimeEqual(provided, envValue);
  return { ok: match, source: 'environment', reason: match ? 'ok' : 'wrong_key' };
}

// ── Rotation ─────────────────────────────────────────────────────────────────

export interface RotationOutcome {
  ok: true;
  /** The only moment this value exists outside the caller's clipboard. */
  value: string;
  prefix: string;
  newId: string;
  /** Prefix of the key this replaced, or null if a database key did not exist. */
  retiredPrefix: string | null;
  /** What stopped working: a previous database key, or the environment value. */
  supersededSource: 'database' | 'environment' | 'none';
}

export interface RotationFailure {
  ok: false;
  error: 'table_missing' | 'rotation_failed';
  message: string;
}

/**
 * Retire whatever is live and issue a new key, in ONE database transaction.
 *
 * Two round trips could leave two keys valid at once, which is the one thing
 * rotation must never do, or in the other order leave none at all if the second
 * call failed. The migration's plpgsql function does both halves or neither.
 */
export async function rotateApiKey(
  sb: SupabaseClient,
  keyId: string,
  admin: { id: string | null; email: string },
  envReader?: EnvReader,
): Promise<RotationOutcome | RotationFailure> {
  const generated = generateKeyRecord();

  // Read the state BEFORE rotating, so the audit row can say truthfully what
  // this rotation superseded. Afterwards the answer is always "a database key".
  const before = await resolveKeyState(sb, keyId, envReader);
  if (before.readError) {
    return { ok: false, error: 'rotation_failed', message: before.readError };
  }
  if (before.tableMissing) {
    return {
      ok: false,
      error: 'table_missing',
      message: 'Migration 213 (public_api_keys) has not been applied to this database yet.',
    };
  }

  const { data, error } = await sb.rpc('rotate_public_api_key', {
    p_key_id: keyId,
    p_key_hash: generated.hash,
    p_key_prefix: generated.prefix,
    p_admin_id: admin.id || null,
    p_admin_email: admin.email,
  });

  if (error) {
    if (isTableMissing(error)) {
      return {
        ok: false,
        error: 'table_missing',
        message: 'Migration 213 (public_api_keys) has not been applied to this database yet.',
      };
    }
    return { ok: false, error: 'rotation_failed', message: error.message };
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { new_id?: string; retired_prefix?: string | null }
    | null;

  return {
    ok: true,
    value: generated.value,
    prefix: generated.prefix,
    newId: row?.new_id ?? '',
    retiredPrefix: row?.retired_prefix ?? null,
    supersededSource: before.source === 'database' ? 'database' : before.source === 'environment' ? 'environment' : 'none',
  };
}
